import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Organisation } from '../../organisations/entities/organisation.entity.js';

import { MessageThread } from './message-thread.entity.js';

@Entity('message_thread_reads')
@Index('UQ_message_thread_reads_thread_user', ['threadId', 'userId'], {
  unique: true,
})
@Index('IDX_message_thread_reads_user', ['userId', 'threadId'])
export class MessageThreadRead {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

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
  userId!: string;

  @Column({ type: 'timestamptz' })
  lastReadAt!: Date;
}
