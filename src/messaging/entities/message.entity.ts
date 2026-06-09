import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';

import { MessageAttachment } from './message-attachment.entity.js';
import { MessageThread } from './message-thread.entity.js';

@Entity('messages')
@Index('IDX_messages_thread_created', ['threadId', 'createdAt'])
@Index('IDX_messages_org_thread', ['organisationId', 'threadId'])
export class Message extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  threadId!: string;

  @ManyToOne(() => MessageThread, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'threadId' })
  thread!: MessageThread;

  @Column({ type: 'uuid' })
  senderUserId!: string;

  @Column({ type: 'text' })
  body!: string;

  @OneToMany(() => MessageAttachment, (attachment) => attachment.message)
  attachments!: MessageAttachment[];
}
