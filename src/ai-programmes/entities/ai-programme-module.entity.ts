import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Programme } from '../../programmes/entities/programme.entity.js';

@Entity('ai_programme_modules')
@Index('UQ_ai_programme_modules_programme_slug', ['programmeId', 'slug'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class AiProgrammeModule extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  programmeId!: string;

  @ManyToOne(() => Programme, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'programmeId' })
  programme!: Programme;

  @Column({ type: 'varchar', length: 64 })
  slug!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'int' })
  sortOrder!: number;

  @Column({ type: 'text', nullable: true })
  description!: string | null;
}
