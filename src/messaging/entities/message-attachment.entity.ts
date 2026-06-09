import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';

import { Message } from './message.entity.js';

@Entity('message_attachments')
@Index('IDX_message_attachments_message', ['messageId'])
export class MessageAttachment extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  messageId!: string;

  @ManyToOne(() => Message, (message) => message.attachments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'messageId' })
  message!: Message;

  @Column({ type: 'varchar', length: 1024 })
  storageKey!: string;

  @Column({ type: 'varchar', length: 255 })
  filename!: string;

  @Column({ type: 'varchar', length: 127 })
  contentType!: string;

  @Column({ type: 'int' })
  contentLength!: number;
}
