import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ReviewReminderKind } from '../enums/review-reminder-kind.enum.js';

import { Review } from './review.entity.js';

@Entity('review_reminder_dispatches')
export class ReviewReminderDispatch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  /**
   * The tenant this reminder belongs to, copied from the review.
   *
   * The table carried no organisation, so it had no policy either and the
   * sweep's already-sent guard was the one read in that job with no tenant
   * applied to it (migration 1781100000062).
   */
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  reviewId!: string;

  @ManyToOne(() => Review, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reviewId' })
  review!: Review;

  @Column({
    type: 'enum',
    enum: ReviewReminderKind,
    enumName: 'review_reminder_kind',
  })
  reminderKind!: ReviewReminderKind;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  sentAt!: Date;
}
