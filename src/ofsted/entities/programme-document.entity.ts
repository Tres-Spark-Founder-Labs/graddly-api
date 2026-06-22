import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { Programme } from '../../programmes/entities/programme.entity.js';
import { ProgrammeDocumentType } from '../enums/programme-document-type.enum.js';

@Entity('programme_documents')
@Index(
  'UQ_programme_documents_programme_type',
  ['programmeId', 'documentType'],
  {
    unique: true,
    where: `"isDeleted" = false`,
  },
)
export class ProgrammeDocument extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  programmeId!: string;

  @ManyToOne(() => Programme, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'programmeId' })
  programme!: Programme;

  @Column({
    type: 'enum',
    enum: ProgrammeDocumentType,
    enumName: 'programme_document_type',
  })
  documentType!: ProgrammeDocumentType;

  @Column({ type: 'varchar', length: 512 })
  storageKey!: string;

  @Column({ type: 'timestamptz' })
  uploadedAt!: Date;
}
