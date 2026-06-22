import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { CommitmentChaseKind } from '../enums/commitment-chase-kind.enum.js';

import { CommitmentSignature } from './commitment-signature.entity.js';

@Entity('commitment_chase_dispatches')
@Index(
  'UQ_commitment_chase_dispatches_signature_kind',
  ['signatureId', 'chaseKind'],
  {
    unique: true,
    where: `"isDeleted" = false`,
  },
)
export class CommitmentChaseDispatch extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  signatureId!: string;

  @ManyToOne(() => CommitmentSignature, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'signatureId' })
  signature!: CommitmentSignature;

  @Column({
    type: 'enum',
    enum: CommitmentChaseKind,
    enumName: 'commitment_chase_kind',
  })
  chaseKind!: CommitmentChaseKind;

  @Column({ type: 'timestamptz' })
  sentAt!: Date;
}
