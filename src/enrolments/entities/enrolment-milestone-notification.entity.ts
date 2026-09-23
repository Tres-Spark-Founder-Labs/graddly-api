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
import { MilestoneNotificationOutcome } from '../enums/milestone-notification-outcome.enum.js';

import { Enrolment } from './enrolment.entity.js';

/**
 * F3.4.3 AC2 — whether the apprentice has already been told about a milestone.
 *
 * The journey timeline stays derived (see `buildMilestones`); this stores only
 * what the derivation cannot know. Nothing in the API reads it.
 *
 * `milestoneKey` is stable, not the positional code the API returns:
 * `enrolment`, `induction`, `gateway`, `epa`, `completion`, or
 * `review:<reviewId>`. See migration 1781100000064 for why, and for why there
 * is no "claimed but unsent" state.
 */
@Entity('enrolment_milestone_notifications')
@Index(
  'UQ_enrolment_milestone_notifications_enrolment_key',
  ['enrolmentId', 'milestoneKey'],
  { unique: true },
)
export class EnrolmentMilestoneNotification {
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
  enrolmentId!: string;

  @ManyToOne(() => Enrolment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrolmentId' })
  enrolment!: Enrolment;

  @Column({ type: 'varchar', length: 80 })
  milestoneKey!: string;

  @Column({
    type: 'enum',
    enum: MilestoneNotificationOutcome,
    enumName: 'enrolment_milestone_notification_outcome',
  })
  outcome!: MilestoneNotificationOutcome;

  /** The milestone's own date, as the timeline derived it. */
  @Column({ type: 'date', nullable: true })
  completedOn!: string | null;

  /**
   * Set exactly when `outcome` is `notified` — a database check constraint
   * holds the two together, so a row can never mean both "seeded, never send"
   * and "claimed but never delivered".
   */
  @Column({ type: 'timestamptz', nullable: true })
  notifiedAt!: Date | null;

  /** Why a seeded row was not sent, in words, for whoever asks later. */
  @Column({ type: 'text', nullable: true })
  reason!: string | null;
}
