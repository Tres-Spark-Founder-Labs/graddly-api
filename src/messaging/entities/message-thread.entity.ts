import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { Apprentice } from '../../apprentices/entities/apprentice.entity.js';
import { BaseEntity } from '../../common/entities/base.entity.js';
import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { MessageThreadParty } from '../enums/message-thread-party.enum.js';

@Entity('message_threads')
@Index(
  'UQ_message_threads_enrolment_party',
  ['enrolmentId', 'counterpartyParty'],
  {
    unique: true,
    where: `"isDeleted" = false`,
  },
)
@Index('IDX_message_threads_org_enrolment', ['organisationId', 'enrolmentId'])
export class MessageThread extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  enrolmentId!: string;

  @ManyToOne(() => Enrolment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrolmentId' })
  enrolment!: Enrolment;

  @Column({ type: 'uuid' })
  apprenticeId!: string;

  @ManyToOne(() => Apprentice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'apprenticeId' })
  apprentice!: Apprentice;

  @Column({
    type: 'enum',
    enum: MessageThreadParty,
    enumName: 'message_thread_party',
  })
  counterpartyParty!: MessageThreadParty;

  @Column({ type: 'uuid' })
  apprenticeUserId!: string;

  @Column({ type: 'uuid' })
  counterpartyUserId!: string;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;
}
