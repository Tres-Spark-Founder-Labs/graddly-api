import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { LevyTransferDocumentStatus } from '../enums/levy-transfer-document-status.enum.js';

import { LevyTransfer } from './levy-transfer.entity.js';

@Entity('levy_transfer_documents')
@Index('UQ_levy_transfer_documents_transfer', ['transferId'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class LevyTransferDocument extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  transferId!: string;

  @ManyToOne(() => LevyTransfer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transferId' })
  transfer!: LevyTransfer;

  @Column({ type: 'uuid', nullable: true })
  pdfJobId!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  unsignedStorageKey!: string | null;

  /** The donor's lasting copy of the fully signed agreement, in the donor's storage. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  signedStorageKey!: string | null;

  /**
   * The recipient's lasting copy of the fully signed agreement, in the
   * recipient's own storage (F4.2.4 AC3: copies in both parties' libraries).
   * Null on transfers completed before migration 1781100000055; those fall
   * back to the donor's copy.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  recipientSignedStorageKey!: string | null;

  @Column({
    type: 'enum',
    enum: LevyTransferDocumentStatus,
    enumName: 'levy_transfer_document_status',
    default: LevyTransferDocumentStatus.PENDING,
  })
  status!: LevyTransferDocumentStatus;
}
