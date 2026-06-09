import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { LevyTransferParty } from '../enums/levy-transfer-party.enum.js';

import { LevyTransfer } from './levy-transfer.entity.js';

@Entity('levy_transfer_signatures')
@Index('UQ_levy_transfer_signatures_party', ['transferId', 'party'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class LevyTransferSignature extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  transferId!: string;

  @ManyToOne(() => LevyTransfer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transferId' })
  transfer!: LevyTransfer;

  @Column({
    type: 'enum',
    enum: LevyTransferParty,
    enumName: 'levy_transfer_party',
  })
  party!: LevyTransferParty;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid', nullable: true })
  signatureRecordId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  signedAt!: Date | null;

  @Column({ type: 'int' })
  signOrder!: number;
}
